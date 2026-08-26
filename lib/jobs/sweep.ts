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
  // A hop is CUTTING when it happened at work rhythm — TIME separates cutting
  // from transit where distance could not. An impact-triggered sensor on
  // smooth fast ground goes 6–18 s between bumps at 4+ m/s, producing
  // 26–70 m hops that are genuine cutting (Aug 23: ~45% of cutting distance
  // lived in such hops; the old 25 m cap hid it and read two fully cut
  // fields at 37%/51%). Transit between fields runs MINUTES quiet (162–273 s
  // observed). The distance ceiling is a backstop so a GPS teleport can
  // never paint a swath across the field.
  cutHopMaxS: 60,
  cutHopMaxM: 200,
  // Floor detection — the sweep's own honesty about undersampling. A quick
  // hop longer than floorLongHopM paints a straight chord where the real
  // path curved, and stretches with no events at all paint nothing; when the
  // share of such hops is material, the percent is a LOWER BOUND and every
  // display must say "at least", never "about". Aug 23's fully cut fields
  // measure 21–24%; Aug 10's bumpy dense-sampled field measures well under
  // the threshold. Provenance (the measured share) rides the result.
  floorLongHopM: 25,
  floorShareThreshold: 0.1,
  // Second floor detector — DISTANCE ACCOUNTING, for the failure mode hop
  // statistics cannot see: on dense rows GPS scatter opens gaps between
  // passes painted at exactly half a header, so a fully cut field reads ~75%
  // while its hop distribution is identical to a half-cut one (Sunday PM
  // Field A vs Aug 10 — twins on every hop measure). The machine's cutting
  // path × header ÷ field area says whether it drove enough to cover the
  // field regardless of where the paint landed: finished fields sit at
  // 1.02–1.24, partials at 0.14–0.54. Path covers the field but the raster
  // says otherwise → the raster is undercounting → floor.
  pathCoverMinRatio: 0.9,
  pathCoverSweepBelow: 0.9,
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
   * The sweep is a LOWER BOUND, not an estimate: a material share of this
   * field's cutting hops covered more ground than the paint can honestly
   * reconstruct (sparse impacts on smooth fast ground — long straight chords
   * where the path curved, and stretches with no events at all). Every
   * display must say "at least N% / at least N acres", never "about".
   */
  sweepIsFloor: boolean
  /** Provenance: which detector(s) fired. Empty when the sweep is not a floor. */
  floorReasons: FloorReason[]
  /** Long-hop detector input: measured share of quick hops > floorLongHopM. */
  longHopShare: number
  /** Path-cover detector input: cutting path × header ÷ field area. */
  pathCoverRatio: number
}

export type FloorReason =
  | 'long_hops' // sparse sampling: the sensor outran its own impacts
  | 'path_cover' // GPS scatter: the machine drove enough to cover the field, the raster missed it

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

  // Paint the swath: cells within half a header of any cutting hop. A hop is
  // cutting when it happened at work rhythm (dt ≤ cutHopMaxS) — an evicted
  // block mid-row or a sparse-impact fast stretch was still real cutting,
  // while a transit hop is minutes quiet and must not paint a swath across
  // the field. The distance ceiling backstops GPS teleports.
  const swept = new Uint8Array(cols * rows)
  const maxHop2 = SWEEP_CONFIG.cutHopMaxM ** 2
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const b = xy[i]
    const dt = pts[i].t - pts[i - 1].t
    if (dt > SWEEP_CONFIG.cutHopMaxS) continue
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

  // Floor detection, from this track's own hops: among quick hops (work
  // rhythm, dt ≤ cutHopMaxS), how many jumped farther than floorLongHopM?
  // Those hops are the sensor outrunning its own sampling — measured, never
  // assumed. Distances in projected meters via the same lat0 anchor.
  const pts = endIdx != null ? track.slice(0, endIdx + 1) : track
  const lat0 = meanLat(track)
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  let quickHops = 0
  let longHops = 0
  let cuttingPathM = 0
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    if (dt > SWEEP_CONFIG.cutHopMaxS) continue
    const dx = (pts[i].lng - pts[i - 1].lng) * mPerLng
    const dy = (pts[i].lat - pts[i - 1].lat) * M_PER_LAT
    const d2 = dx * dx + dy * dy
    quickHops++
    if (d2 > SWEEP_CONFIG.floorLongHopM ** 2) longHops++
    // The same hops the paint counts as cutting (the distance ceiling backstops teleports).
    if (d2 <= SWEEP_CONFIG.cutHopMaxM ** 2) cuttingPathM += Math.sqrt(d2)
  }
  const longHopShare = quickHops > 0 ? longHops / quickHops : 0
  const boundaryInsideM2 = g.boundaryCells * cellArea
  const pathCoverRatio = boundaryInsideM2 > 0 ? (cuttingPathM * BOUNDARY_CONFIG.headerWidthM) / boundaryInsideM2 : 0

  // Two detectors, two failure modes, floor if EITHER fires — provenance
  // rides the result so the display can say which.
  const floorReasons: FloorReason[] = []
  if (longHopShare > SWEEP_CONFIG.floorShareThreshold) floorReasons.push('long_hops')
  if (pathCoverRatio >= SWEEP_CONFIG.pathCoverMinRatio && rawFraction < SWEEP_CONFIG.pathCoverSweepBelow) {
    floorReasons.push('path_cover')
  }

  const stepped = Math.round((rawFraction * 100) / SWEEP_CONFIG.percentStep) * SWEEP_CONFIG.percentStep
  return {
    percentCut: Math.max(0, Math.min(100, stepped)),
    sweptInsideM2: g.sweptInside * cellArea,
    boundaryInsideM2,
    rawFraction,
    sweepIsFloor: floorReasons.length > 0,
    floorReasons,
    longHopShare,
    pathCoverRatio,
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
  /** Cut ground, IMPRESSIONISTIC: painted at a display-only radius, hops
   *  bridged liberally, closed, holes kept only where physically real, then
   *  traced and smoothed. Clipped to the field mask at the raster stage — it
   *  cannot spill outside. A picture of where the machine has been, never
   *  the number: percent and acres come from the measurement sweep only. */
  fill: RenderedPolygon[]
  boundaryRenderedM2: number
  boundaryRasterM2: number
  boundaryDivergence: number
  /** The rendered boundary sits within divergenceCap of its raster — the only
   *  condition under which the edge may be drawn. */
  boundaryOk: boolean
  /** Area of the drawn fill polygons (informational — the picture). */
  fillRenderedM2: number
  /** Area the MEASUREMENT sweep counts (the number). The picture runs over
   *  it by design; the gap is reported, never "corrected". */
  fillRasterM2: number
  /** Share of fill vertices lying outside the boundary ring + margin. The one
   *  fill guard: paint escaping the field is geometric nonsense and fails
   *  the build. Clipping makes this ~0 by construction. */
  fillEscapeShare: number
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

  // Cut ground — the PICTURE. Repaint the track on the same grid at the
  // display radius with the liberal display hop rule, clipped to the field;
  // then close, apply hole physics, trace, smooth. No area matching: the
  // number is the raster's, the picture is allowed to run generous.
  const lat0 = meanLat(track)
  const xy = projectXY(track, lat0)
  const rd = RENDER_CONFIG.displayRadiusM
  const maxHop2 = RENDER_CONFIG.displayHopMaxM ** 2
  const painted = new Uint8Array(g.cols * g.rows)
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const b = xy[i]
    if (track[i].t - track[i - 1].t > RENDER_CONFIG.displayHopMaxS) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * dx + dy * dy > maxHop2) continue
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - rd - g.minX) / g.cellM))
    const x1 = Math.min(g.cols - 1, Math.floor((Math.max(a.x, b.x) + rd - g.minX) / g.cellM))
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - rd - g.minY) / g.cellM))
    const y1 = Math.min(g.rows - 1, Math.floor((Math.max(a.y, b.y) + rd - g.minY) / g.cellM))
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * g.cols + cx
        if (painted[k] || !g.inside[k]) continue
        const center: Pt = { x: g.minX + (cx + 0.5) * g.cellM, y: g.minY + (cy + 0.5) * g.cellM }
        if (distToSegment(center, a, b) <= rd) painted[k] = 1
      }
    }
  }
  const closedRaw = morphClose({ ...g, mask: painted }, RENDER_CONFIG.displayCloseRadiusCells)
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
  // Holes survive only above the physics floor (RENDER_CONFIG.holeMinM2).
  const MIN_RING_M2 = 25
  const rings = traceMask(g, closed).filter(r => Math.abs(r.area) >= MIN_RING_M2)
  const outers = rings.filter(r => r.area > 0)
  const holes = rings.filter(r => r.area < 0 && Math.abs(r.area) >= RENDER_CONFIG.holeMinM2)
  const holesSuppressed = rings.filter(r => r.area < 0 && Math.abs(r.area) < RENDER_CONFIG.holeMinM2).length

  const smoothOuters = outers.map(o => smoothRing(o.ring))
  const smoothHoles: { ring: Pt[]; ownerIdx: number }[] = []
  for (const h of holes) {
    const probe = h.ring[0]
    const ownerIdx = outers.findIndex(o => pointInPolygon(probe, o.ring))
    if (ownerIdx === -1) continue
    smoothHoles.push({ ring: smoothRing(h.ring), ownerIdx })
  }

  let fillRenderedM2 = 0
  const polys: RenderedPolygon[] = smoothOuters.map(o => {
    fillRenderedM2 += Math.abs(signedArea(o))
    return { outer: o.map(toLatLng), holes: [] }
  })
  smoothHoles.forEach(h => {
    fillRenderedM2 -= Math.abs(signedArea(h.ring))
    polys[h.ownerIdx].holes.push(h.ring.map(toLatLng))
  })

  // The one fill guard: every drawn vertex must sit inside the drawn field
  // edge (+ a cell of smoothing slack). Clipping guarantees it; the guard
  // proves it every run.
  // Judged against the RAW traced clip edge (what the raster actually
  // clipped to), with the slack smoothing can legitimately add — the smoothed
  // boundary line cuts corners inward, and that is style, not a leak.
  const rawEdge = fieldRings[0].ring
  const slack = RENDER_CONFIG.simplifyTolM + g.cellM
  let outside = 0
  let total = 0
  for (const o of smoothOuters) {
    for (const v of o) {
      total++
      if (!pointInPolygon(v, rawEdge) && distToRing(v, rawEdge) > slack) outside++
    }
  }
  const fillEscapeShare = total > 0 ? outside / total : 0

  const boundaryDivergence = Math.abs(boundaryRenderedM2 - boundaryRasterM2) / boundaryRasterM2

  return {
    boundaryRing: boundarySmooth.map(toLatLng),
    fill: polys,
    boundaryRenderedM2,
    boundaryRasterM2,
    boundaryDivergence,
    boundaryOk: boundaryDivergence <= RENDER_CONFIG.divergenceCap,
    fillRenderedM2,
    fillRasterM2: g.sweptInside * cellArea,
    fillEscapeShare,
    holesSuppressed,
  }
}
