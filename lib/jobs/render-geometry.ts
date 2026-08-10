import type { Pt } from './boundary'

// ─── Render geometry — the picture, never the number ───────────────────────────
//
// THE RULE: the data is exact and chunky; the map is not. Percent and acreage
// come from the raster and only the raster. Everything in this module exists
// to draw that raster as cartography — one confident boundary line, one
// complete-looking fill — and every consumer must hold the result against the
// raster it came from (RENDER_CONFIG.divergenceCap, asserted in the CLI).
// If the picture drifts more than a few percent from the number, the
// smoothing is lying and the build fails.
//
// Pipeline, for both the field mask and the swept mask:
//   binary grid → (fill only: morphological close — dilate then erode, the
//   one operation that turns spotty into complete without changing the
//   overall shape) → contour trace (grid-edge following, outer rings and
//   holes) → light simplify (Douglas-Peucker under the GPS scatter) →
//   Chaikin corner-cutting → polygon.
//
// Pure module: no I/O, no Leaflet, no Date.now(). Operates in projected
// meters; callers convert to lat/lng.

export const RENDER_CONFIG = {
  simplifyTolM: 3.5, // under the 3.7 m GPS scatter — smooths wobble, keeps shape
  chaikinIterations: 2,
  closeRadiusCells: 1, // dilate+erode by one 2.5 m cell: pinholes and pass gaps
  divergenceCap: 0.05, // rendered area may sit at most this far from the raster
  // A real obstacle must be WIDER THAN THE HEADER — anything narrower gets cut
  // over or around within a single pass and never leaves a hole. Physics, not
  // a tuned constant: ~2 header widths minimum. Enforced as a WIDTH rule —
  // morphological opening of the hole region (erode then dilate) erases any
  // hole feature narrower than ~2×radius, whether it's an isolated pocket OR
  // a narrow notch hanging off the genuine uncut middle (an area floor alone
  // can't reach those). Holes that survive are ground the operator genuinely
  // drove around — a tree, a well vent, a rock pile.
  holeOpenRadiusCells: 2, // 2 × 2.5 m cells each way ⇒ features under ~10 m die
  holeMinM2: 200, // and the area proxy (~0.05 ac) mops up surviving slivers
  // The area-matching offset must stay invisible: if the shrink needed to
  // absorb close-gain + suppressed holes ever approaches the GPS scatter, the
  // outline is being visibly distorted to hit the number — fail loudly (CLI)
  // instead of silently applying it.
  offsetMaxM: 1.8, // ≈ half the 3.7 m scatter
} as const

export interface MaskGrid {
  cols: number
  rows: number
  cellM: number
  minX: number
  minY: number
  mask: Uint8Array
}

// 8-neighbor square structuring element — dilate then erode = morphological
// close. Closing is extensive (result ⊇ input): it only ever fills, never
// eats the original, so the divergence guard measures pure gain.
export function morphClose(grid: MaskGrid, radiusCells: number): Uint8Array {
  const { cols, rows } = grid
  let cur = grid.mask
  for (let pass = 0; pass < radiusCells; pass++) cur = dilate8(cur, cols, rows)
  for (let pass = 0; pass < radiusCells; pass++) cur = erode8(cur, cols, rows)
  return cur
}

// Erode then dilate = morphological open: features of the mask narrower than
// ~2×radius disappear; wide bodies keep their shape. Applied to the HOLE
// region, this is the width leg of the obstacle physics rule.
export function morphOpen(grid: MaskGrid, radiusCells: number): Uint8Array {
  const { cols, rows } = grid
  let cur = grid.mask
  for (let pass = 0; pass < radiusCells; pass++) cur = erode8(cur, cols, rows)
  for (let pass = 0; pass < radiusCells; pass++) cur = dilate8(cur, cols, rows)
  return cur
}

function dilate8(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!mask[cy * cols + cx]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out[ny * cols + nx] = 1
        }
      }
    }
  }
  return out
}

function erode8(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1 && keep; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || !mask[ny * cols + nx]) keep = 0
        }
      }
      out[cy * cols + cx] = keep
    }
  }
  return out
}

// ─── Contour trace — grid-edge following ───────────────────────────────────────
// Emits every boundary edge directed so the filled region sits on its LEFT,
// then chains edges into closed rings. With y up, outer rings come out
// counter-clockwise (positive shoelace) and holes clockwise (negative) —
// orientation IS the outer/hole classification. Corners where two filled
// cells touch only diagonally carry two outgoing edges; chaining just takes
// either — the rings still close, the areas still add up.
export function traceMask(grid: MaskGrid, mask: Uint8Array): { ring: Pt[]; area: number }[] {
  const { cols, rows, cellM, minX, minY } = grid
  const at = (cx: number, cy: number) =>
    cx >= 0 && cx < cols && cy >= 0 && cy < rows ? mask[cy * cols + cx] : 0

  // corner key → list of directed edges leaving that corner
  const key = (cx: number, cy: number) => cy * (cols + 1) + cx
  const outgoing = new Map<number, number[]>() // from-corner → to-corner list
  const addEdge = (fx: number, fy: number, tx: number, ty: number) => {
    const k = key(fx, fy)
    const arr = outgoing.get(k)
    if (arr) arr.push(key(tx, ty))
    else outgoing.set(k, [key(tx, ty)])
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!mask[cy * cols + cx]) continue
      if (!at(cx, cy - 1)) addEdge(cx, cy, cx + 1, cy) // south edge, walk east
      if (!at(cx, cy + 1)) addEdge(cx + 1, cy + 1, cx, cy + 1) // north edge, walk west
      if (!at(cx - 1, cy)) addEdge(cx, cy + 1, cx, cy) // west edge, walk south
      if (!at(cx + 1, cy)) addEdge(cx + 1, cy, cx + 1, cy + 1) // east edge, walk north
    }
  }

  const toPt = (k: number): Pt => ({
    x: minX + (k % (cols + 1)) * cellM,
    y: minY + Math.floor(k / (cols + 1)) * cellM,
  })

  const rings: { ring: Pt[]; area: number }[] = []
  for (const [startKey, list] of outgoing) {
    while (list.length > 0) {
      // Walk a ring to closure, consuming edges as we go.
      const ringKeys: number[] = [startKey]
      let cur = list.pop()!
      while (cur !== startKey) {
        ringKeys.push(cur)
        const nexts = outgoing.get(cur)
        if (!nexts || nexts.length === 0) break // defensive: never happens on a well-formed mask
        cur = nexts.pop()!
      }
      if (cur !== startKey) continue
      // Merge collinear runs (the staircase's straight stretches).
      const pts = ringKeys.map(toPt)
      const ring: Pt[] = []
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[(i - 1 + pts.length) % pts.length]
        const p = pts[i]
        const next = pts[(i + 1) % pts.length]
        const collinear = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x) === 0
        if (!collinear) ring.push(p)
      }
      if (ring.length >= 3) rings.push({ ring, area: signedArea(ring) })
    }
  }
  return rings
}

export function signedArea(ring: Pt[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

// ─── Simplify + smooth ─────────────────────────────────────────────────────────

// Douglas-Peucker on a closed ring: split at the two most distant anchors so
// neither half can collapse, simplify each, rejoin.
export function simplifyRing(ring: Pt[], tolM: number): Pt[] {
  if (ring.length <= 4) return ring
  let far = 1
  let farD = -1
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = dp(ring.slice(0, far + 1), tolM)
  const b = dp(ring.slice(far).concat([ring[0]]), tolM)
  const out = a.slice(0, -1).concat(b.slice(0, -1))
  return out.length >= 3 ? out : ring
}

function dp(chain: Pt[], tolM: number): Pt[] {
  if (chain.length <= 2) return chain
  const a = chain[0]
  const b = chain[chain.length - 1]
  let maxD = -1
  let maxI = 1
  for (let i = 1; i < chain.length - 1; i++) {
    const d = perpDist(chain[i], a, b)
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  if (maxD <= tolM) return [a, b]
  const left = dp(chain.slice(0, maxI + 1), tolM)
  const right = dp(chain.slice(maxI), tolM)
  return left.slice(0, -1).concat(right)
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Chaikin corner-cutting on a closed ring — each pass replaces every vertex
// with the ¼ and ¾ points of its edges. Near-area-preserving on the gentle
// shapes that survive simplification; the divergence guard holds it to that.
export function chaikinClosed(ring: Pt[], iterations: number): Pt[] {
  let cur = ring
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % cur.length]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    cur = next
  }
  return cur
}

export function smoothRing(ring: Pt[], cfg: typeof RENDER_CONFIG = RENDER_CONFIG): Pt[] {
  return chaikinClosed(simplifyRing(ring, cfg.simplifyTolM), cfg.chaikinIterations)
}

// ─── Area matching — the close's honesty mechanism ─────────────────────────────
// The morphological close makes the fill look complete by bridging pass gaps
// and pinholes — REAL area the raster didn't count (11.7% on the Aug 10 field,
// against a 5% cap). Weakening the close brings the spots back; widening the
// cap defeats the guard. Instead: keep the complete look and hand the added
// area back by offsetting every fill outline a uniform sub-metre distance
// toward less-fill (outers shrink, holes grow). The offset is excess ÷ total
// perimeter — first-order exact, ~0.3 m on Aug 10, an order of magnitude under
// the GPS scatter. The picture stays complete; the area stays the number's.

// Offset a closed ring by |d| along per-vertex normals, in whichever
// direction changes the enclosed area the way the caller asks. The sign is
// found empirically with a tiny probe offset — immune to orientation
// bookkeeping mistakes, which is exactly where offset bugs live.
export function offsetRing(ring: Pt[], d: number, shrinkEnclosed: boolean): Pt[] {
  if (ring.length < 3 || d === 0) return ring
  const apply = (dist: number): Pt[] =>
    ring.map((p, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length]
      const next = ring[(i + 1) % ring.length]
      const tx = next.x - prev.x
      const ty = next.y - prev.y
      const len = Math.hypot(tx, ty) || 1
      // left normal of travel
      return { x: p.x + (-ty / len) * dist, y: p.y + (tx / len) * dist }
    })
  const base = Math.abs(signedArea(ring))
  const probe = Math.abs(signedArea(apply(0.01)))
  const leftShrinks = probe < base
  const sign = shrinkEnclosed === leftShrinks ? 1 : -1
  return apply(sign * Math.abs(d))
}

export function ringPerimeter(ring: Pt[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return s
}
